'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { ComponentProps, ReactNode } from 'react';
import {
  Controller,
  FormProvider,
  useForm,
  useFormContext,
  type Control,
  type ControllerFieldState,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
  type Resolver,
  type SubmitErrorHandler,
  type SubmitHandler,
  type UseFormProps,
  type UseFormReturn,
  type UseFormStateReturn,
} from 'react-hook-form';
import type { z } from 'zod';

import { Field, type FieldProps } from '../field/field';

/** An object schema: form values are records. */
export type FormSchema = z.ZodType<FieldValues, FieldValues>;

export type UseZodFormProps<TSchema extends FormSchema, TContext = unknown> = Omit<
  UseFormProps<z.input<TSchema>, TContext, z.output<TSchema>>,
  'resolver'
>;

/** `useForm` validated by a zod schema (react-hook-form + `zodResolver`). */
export function useZodForm<TSchema extends FormSchema, TContext = unknown>(
  schema: TSchema,
  options?: UseZodFormProps<TSchema, TContext>,
): UseFormReturn<z.input<TSchema>, TContext, z.output<TSchema>> {
  return useForm<z.input<TSchema>, TContext, z.output<TSchema>>({
    ...options,
    // The overloads cannot relate a generic schema to its own input/output; at runtime they match.
    resolver: zodResolver(schema) as unknown as Resolver<
      z.input<TSchema>,
      TContext,
      z.output<TSchema>
    >,
  });
}

export interface FormProps<
  TFieldValues extends FieldValues,
  TContext = unknown,
  TTransformedValues = TFieldValues,
> extends Omit<ComponentProps<'form'>, 'onSubmit' | 'onInvalid'> {
  form: UseFormReturn<TFieldValues, TContext, TTransformedValues>;
  onSubmit: SubmitHandler<TTransformedValues>;
  onInvalid?: SubmitErrorHandler<TFieldValues>;
  children: ReactNode;
}

/** `<form>` that provides the react-hook-form context and validates before `onSubmit`. */
export function Form<
  TFieldValues extends FieldValues,
  TContext = unknown,
  TTransformedValues = TFieldValues,
>({
  form,
  onSubmit,
  onInvalid,
  children,
  ...props
}: FormProps<TFieldValues, TContext, TTransformedValues>) {
  return (
    <FormProvider {...form}>
      <form
        data-slot="form"
        noValidate
        // handleSubmit returns a promise; react-hook-form handles its errors.
        onSubmit={(event) => void form.handleSubmit(onSubmit, onInvalid)(event)}
        {...props}
      >
        {children}
      </form>
    </FormProvider>
  );
}

export interface FormFieldRenderProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> {
  field: ControllerRenderProps<TFieldValues, TName>;
  fieldState: ControllerFieldState;
  formState: UseFormStateReturn<TFieldValues>;
}

export interface FormFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  TTransformedValues = TFieldValues,
> extends Omit<FieldProps, 'children' | 'error' | 'invalid'> {
  name: TName;
  /** Defaults to the surrounding `Form`'s control. */
  control?: Control<TFieldValues, unknown, TTransformedValues>;
  /** Render the control; spread `field` onto it (or map value/onChange for non-input controls). */
  render: (props: FormFieldRenderProps<TFieldValues, TName>) => ReactNode;
}

/** A `Field` bound to one form value: the validation message becomes the field's error. */
export function FormField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  TTransformedValues = TFieldValues,
>({
  name,
  control,
  render,
  ...fieldProps
}: FormFieldProps<TFieldValues, TName, TTransformedValues>) {
  const context = useFormContext<TFieldValues, unknown, TTransformedValues>();
  return (
    <Controller
      name={name}
      control={control ?? context.control}
      disabled={fieldProps.disabled ?? false}
      render={({ field, fieldState, formState }) => (
        <Field {...fieldProps} error={fieldState.error?.message}>
          {render({ field, fieldState, formState })}
        </Field>
      )}
    />
  );
}
